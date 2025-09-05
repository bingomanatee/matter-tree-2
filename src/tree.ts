import {Bodies, Body, Constraint, Engine, Events, Mouse, MouseConstraint, Render, Runner, World,} from 'matter-js';

// ---------- Config
const CFG = {
    nodeRadius: 12,
    twigRadius: 4, // Small radius for twig nodes
    leafRadius: 8, // Larger radius for actual leaf nodes
    airFriction: 0.05, // Moderate air friction
    spring: {length: 80, stiffness: 0.03, damping: 0.3}, // Moderate spring settings for main branches
    twigSpring: {length: 20, stiffness: 0.015, damping: 0.5}, // Very short, flexible springs for twigs
    leafSpring: {length: 15, stiffness: 0.01, damping: 0.6}, // Even shorter springs for leaves
    repulsion: {k: 1, min: 26, max: 240}, // Low repulsion
    gravity: 0.001, // Light downward gravity
    upwardForce: 0.002, // Increased upward force to reduce drooping
    centerPull: 1e-6, // Very low center pull
    velocityDamping: 0.95, // Moderate velocity damping
};

// ---------- Classes
class TreeNode {
    /** @param {string} id @param {Matter.Body} body */
    constructor(id, body) {
        this.id = id;
        this.body = body;
        /** @type {TreeNode[]} */
        this.children = [];
        /** @type {Matter.Constraint[]} */
        this.edges = [];
    }

    addChild(child, opt = CFG.spring, isLeaf = false) {
        this.children.push(child);
        const c = Constraint.create({
            bodyA: this.body,
            bodyB: child.body,
            length: opt.length,
            stiffness: opt.stiffness,
            damping: opt.damping,
            render: {
                strokeStyle: isLeaf ? '#4a9d4a' : '#6af08e',
                lineWidth: isLeaf ? 1 : 2
            },
        });
        this.edges.push(c);
        return c;
    }

    /** DFS traversal */
    traverse(fn) {
        fn(this);
        for (const ch of this.children) ch.traverse(fn);
    }
}

class TreePhysics {
    constructor(canvas) {
        let engine = this.engine = Engine.create();
        let world = this.world = this.engine.world;

        const width = canvas.width;
        const height = canvas.height;

        let render = this.render = Render.create({
            canvas,
            engine: this.engine,
            options: {
                wireframes: false,
                background: '#0b1020',
                width: width,
                height: height,
                showVelocity: false,
                showAngleIndicator: false,
                showDebug: false
            },
        });

        // Set initial render bounds
        render.bounds.min.x = 0;
        render.bounds.min.y = 0;
        render.bounds.max.x = width;
        render.bounds.max.y = height;

        Render.run(render);

        // Use Matter.js Runner for proper physics timing
        const runner = Runner.create();
        Runner.run(runner, engine);

        // Debug: log that engine is running
        console.log('Physics engine started with Runner');

        // Optional walls to keep things on screen
        const wallOpts = {isStatic: true, render: {visible: false}};
        World.add(world, [
            Bodies.rectangle(canvas.width / 2, -50, canvas.width, 100, wallOpts),
            Bodies.rectangle(canvas.width / 2, canvas.height + 50, canvas.width, 100, wallOpts),
            Bodies.rectangle(-50, canvas.height / 2, 100, canvas.height, wallOpts),
            Bodies.rectangle(canvas.width + 50, canvas.height / 2, 100, canvas.height, wallOpts),
        ]);

        // Mouse drag
        const mouse = Mouse.create(canvas);
        const mouseConstraint = MouseConstraint.create(this.engine, {
            mouse,
            constraint: {stiffness: 0.2, render: {visible: false}},
        });
        World.add(world, mouseConstraint);
        this.render.mouse = mouse;

        // bookkeeping
        this.nodes = [];
        this.nodeBodies = [];

        // per-tick forces
        Events.on(this.engine, 'beforeUpdate', () => this.applyForces());

        // Handle canvas resize
        window.addEventListener('resize', () => {
            const canvas = this.render.canvas;
            const container = canvas.parentElement;
            if (container) {
                const containerStyle = getComputedStyle(container);
                const paddingLeft = parseFloat(containerStyle.paddingLeft);
                const paddingRight = parseFloat(containerStyle.paddingRight);
                const paddingTop = parseFloat(containerStyle.paddingTop);
                const paddingBottom = parseFloat(containerStyle.paddingBottom);

                const newWidth = container.clientWidth - paddingLeft - paddingRight;
                const newHeight = container.clientHeight - paddingTop - paddingBottom;

                canvas.width = newWidth;
                canvas.height = newHeight;
                canvas.style.width = newWidth + 'px';
                canvas.style.height = newHeight + 'px';

                // Update render options
                this.render.options.width = newWidth;
                this.render.options.height = newHeight;
                this.render.bounds.min.x = 0;
                this.render.bounds.min.y = 0;
                this.render.bounds.max.x = newWidth;
                this.render.bounds.max.y = newHeight;

                // Update root pin position if it exists
                if (this.rootPin) {
                    this.rootPin.pointA.x = this.center.x;
                    this.rootPin.pointA.y = this.center.y * 1.25;
                }
            }
        });
    }

    get center() {
        return {
            x: this.render.canvas.width * 0.5,
            y: this.render.canvas.height * 0.5
        };
    }

    /** Build a tree from adjacency (parent->children) and rootId, with layered initial positions */
    buildTree({adjacency, rootId}) {
        // group to disable collisions among nodes
        const group = -Math.abs(
            Bodies.circle(0, 0, 1).collisionFilter.group || Body.nextGroup(true)
        );

        // compute depths for layout
        const depth = new Map([[rootId, 0]]);
        const q = [rootId];
        while (q.length) {
            const p = q.shift();
            for (const c of adjacency.get(p) || []) {
                if (!depth.has(c)) {
                    depth.set(c, (depth.get(p) ?? 0) + 1);
                    q.push(c);
                }
            }
        }
        const maxDepth = Math.max(...depth.values());
        const counts = new Map();
        for (const [id, d] of depth) counts.set(d, (counts.get(d) || 0) + 1);
        const idxByDepth = new Map();

        const makeBody = (id) => {
            const d = depth.get(id) ?? 0;
            const k = idxByDepth.get(d) || 0;
            idxByDepth.set(d, k + 1);
            const slots = counts.get(d);
            // Distribute nodes across 60% of canvas width, centered
            const spreadWidth = this.render.canvas.width * 0.6;
            const nodePosition = ((k + 1) / (slots + 1)) * spreadWidth;
            const x = this.center.x - spreadWidth * 0.5 + nodePosition;
            const y = this.render.canvas.height - 120 - d * 90; // Start from bottom, grow upward
            const b = Bodies.circle(x, y, CFG.nodeRadius, {
                frictionAir: CFG.airFriction,
                render: {
                    fillStyle: '#75d7ff',
                    strokeStyle: '#dff6ff',
                    lineWidth: 1.5,
                },
                collisionFilter: {group},
            });
            b.label = id;
            return b;
        };

        const bodyCache = new Map();
        const getBody = (id) =>
            bodyCache.get(id) || (bodyCache.set(id, makeBody(id)), bodyCache.get(id));

        const buildRec = (id) => {
            const node = new TreeNode(id, getBody(id));
            const children = adjacency.get(id) || [];

            for (const cid of children) {
                const child = buildRec(cid);
                const cons = node.addChild(child, CFG.spring);
                World.add(this.world, cons);

                // Add leaf/twig nodes between parent and child (skip for root level)
                if (depth.get(id) > 0) {
                    this.addLeafNodes(node, child);
                }
            }

            // Add leaves to terminal nodes (end nodes with no children)
            if (children.length === 0 && depth.get(id) > 0) {
                this.addTerminalLeaves(node);
            }

            return node;
        };

        const root = buildRec(rootId);
        const bodies = [...bodyCache.values()];
        World.add(this.world, bodies);

        // Pin root firmly at bottom so the tree grows upward like a real tree
        this.rootPin = Constraint.create({
            pointA: {x: this.center.x, y: this.render.canvas.height - 100}, // Pin near bottom of canvas
            bodyB: root.body,
            length: 0, // No distance - root is fixed at this point
            stiffness: 1.0, // Maximum stiffness - root cannot move
            damping: 0.9, // High damping to prevent oscillation
            render: {visible: false},
        });
        World.add(this.world, this.rootPin);

        // store refs
        this.root = root;
        this.nodes = [];
        root.traverse((n) => this.nodes.push(n));
        this.nodeBodies = this.nodes.map((n) => n.body);

        // Add very gentle initial random velocities
        this.nodeBodies.forEach(body => {
            Body.setVelocity(body, {
                x: (Math.random() - 0.5) * 0.5,
                y: (Math.random() - 0.5) * 0.5
            });
        });

        console.log(`Tree created with ${this.nodeBodies.length} bodies`);

        // Debug: log positions occasionally to see if bodies are moving
        setInterval(() => {
            if (this.nodeBodies.length > 0) {
                const firstBody = this.nodeBodies[0];
                console.log('First body position:', firstBody.position.x.toFixed(2), firstBody.position.y.toFixed(2));
            }
        }, 2000);

        return root;
    }

    addLeafNodes(parentNode, childNode) {
        // Create 2-4 small leaf/twig nodes between parent and child
        const numLeaves = 2 + Math.floor(Math.random() * 3); // 2-4 leaves

        for (let i = 0; i < numLeaves; i++) {
            // Position leaves around the midpoint between parent and child
            const parentPos = parentNode.body.position;
            const childPos = childNode.body.position;
            const midX = (parentPos.x + childPos.x) * 0.5;
            const midY = (parentPos.y + childPos.y) * 0.5;

            // Add some random offset for natural spread
            const offsetX = (Math.random() - 0.5) * 60;
            const offsetY = (Math.random() - 0.5) * 40;

            const leafBody = Bodies.circle(
                midX + offsetX,
                midY + offsetY,
                CFG.leafRadius,
                {
                    frictionAir: CFG.airFriction * 1.5, // Leaves have more air resistance
                    render: {
                        fillStyle: '#90EE90', // Light green for leaves
                        strokeStyle: '#228B22',
                        lineWidth: 1,
                    },
                    collisionFilter: {group: parentNode.body.collisionFilter.group},
                }
            );
            leafBody.label = `leaf_${parentNode.id}_${i}`;

            const leafNode = new TreeNode(`leaf_${parentNode.id}_${i}`, leafBody);

            // Connect leaf to parent with flexible spring
            const leafConstraint = parentNode.addChild(leafNode, CFG.leafSpring, true);

            World.add(this.world, [leafBody, leafConstraint]);
            this.nodeBodies.push(leafBody);
        }
    }

    addTerminalLeaves(terminalNode) {
        // Create 3-6 leaves around terminal nodes for a fuller appearance
        const numLeaves = 3 + Math.floor(Math.random() * 4); // 3-6 leaves

        for (let i = 0; i < numLeaves; i++) {
            const nodePos = terminalNode.body.position;

            // Create leaves in a circle around the terminal node
            const angle = (i / numLeaves) * Math.PI * 2;
            const radius = 25 + Math.random() * 20; // 25-45 pixels from center

            const leafX = nodePos.x + Math.cos(angle) * radius;
            const leafY = nodePos.y + Math.sin(angle) * radius;

            const leafBody = Bodies.circle(
                leafX,
                leafY,
                CFG.leafRadius,
                {
                    frictionAir: CFG.airFriction * 1.5, // Leaves have more air resistance
                    render: {
                        fillStyle: '#90EE90', // Light green for leaves
                        strokeStyle: '#228B22',
                        lineWidth: 1,
                    },
                    collisionFilter: {group: terminalNode.body.collisionFilter.group},
                }
            );
            leafBody.label = `terminal_leaf_${terminalNode.id}_${i}`;

            const leafNode = new TreeNode(`terminal_leaf_${terminalNode.id}_${i}`, leafBody);

            // Connect leaf to terminal node with flexible spring
            const leafConstraint = terminalNode.addChild(leafNode, CFG.leafSpring, true);

            World.add(this.world, [leafBody, leafConstraint]);
            this.nodeBodies.push(leafBody);
        }
    }

    applyForces() {
        const list = this.nodeBodies;

        // Debug: log occasionally
        if (Math.random() < 0.001) {
            console.log('Applying forces to', list.length, 'bodies');
        }

        // 1) gravity (constant downward force)
        for (const b of list) {
            Body.applyForce(b, b.position, {x: 0, y: CFG.gravity * b.mass});
        }

        // 2) upward force (tree growth force - stronger than gravity)
        for (const b of list) {
            Body.applyForce(b, b.position, {x: 0, y: -CFG.upwardForce * b.mass});
        }

        // 3) repulsion (inverse-square, clamped)
        const {k, min, max} = CFG.repulsion;
        for (let i = 0; i < list.length; i++) {
            const A = list[i];
            for (let j = i + 1; j < list.length; j++) {
                const B = list[j];
                const dx = B.position.x - A.position.x;
                const dy = B.position.y - A.position.y;
                const r2 = dx * dx + dy * dy;
                if (r2 === 0) {
                    continue;
                }
                const r = Math.sqrt(r2);
                if (r > max) {
                    continue;
                }
                const clamped = Math.max(r, min);
                const mag = k / (clamped * clamped);
                const fx = (dx / r) * mag;
                const fy = (dy / r) * mag;
                Body.applyForce(A, A.position, {x: -fx, y: -fy});
                Body.applyForce(B, B.position, {x: fx, y: fy});
            }
        }

        // 4) gentle center pull to keep frame
        for (const b of list) {
            Body.applyForce(b, b.position, {
                x: (this.center.x - b.position.x) * CFG.centerPull,
                y: (this.center.y - b.position.y) * CFG.centerPull,
            });
        }

        // 5) velocity damping to reduce excessive jiggle
        for (const b of list) {
            Body.setVelocity(b, {
                x: b.velocity.x * CFG.velocityDamping,
                y: b.velocity.y * CFG.velocityDamping
            });
        }
    }
}

// ---------- Example usage

export function makeTree(canvas) {
    // Define your tree as adjacency: parent -> [children]
    const edges = [
        ['root', 'root2'],
        ['root2', 'A'],
        ['A', 'B'],
        ['A', 'C'],
        ['B', 'D'],
        ['B', 'E'],
        ['C', 'F'],
        ['C', 'G'],
        ['E', 'H'],
        ['E', 'I'],
        ['G', 'J'],
    ];
    const adjacency = new Map();
    for (const [p, c] of edges)
        adjacency.set(p, (adjacency.get(p) || []).concat(c));

    const scene = new TreePhysics(canvas);

    // Build the tree and let physics run
    const root = scene.buildTree({adjacency, rootId: 'root'});

    // Example: traverse to style leaves differently
    root.traverse((n) => {
        if (n.children.length === 0) {
            n.body.render.fillStyle = '#ffd27c';
        }
    });
}
