import {
  Engine,
  Render,
  Runner,
  World,
  Bodies,
  Body,
  Constraint,
  Composite,
  Events,
  Mouse,
  MouseConstraint,
} from 'matter-js';

// ---------- Config
const CFG = {
  nodeRadius: 12,
  airFriction: 0.03,
  spring: { length: 80, stiffness: 0.06, damping: 0.18 },
  repulsion: { k: 2, min: 26, max: 240 }, // strength, min distance, max influence
  inverseGravity: 0.005, // constant upward force per body per tick (tune!)
  centerPull: 1e-5,
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
  addChild(child, opt = CFG.spring) {
    this.children.push(child);
    const c = Constraint.create({
      bodyA: this.body,
      bodyB: child.body,
      length: opt.length,
      stiffness: opt.stiffness,
      damping: opt.damping,
      render: { strokeStyle: '#6af08e', lineWidth: 2 },
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
    this.engine = Engine.create();
    this.world = this.engine.world;

    const width = canvas.width;
    const height = canvas.height;

    this.render = Render.create({
      canvas,
      engine: this.engine,
      options: { width, height, wireframes: false, background: '#0b1020' },
    });
    Render.run(this.render);
    this.runner = Runner.create();
    Runner.run(this.runner, this.engine);

    // Optional walls to keep things on screen
    const wallOpts = { isStatic: true, render: { visible: false } };
    World.add(this.world, [
      Bodies.rectangle(width / 2, -50, width, 100, wallOpts),
      Bodies.rectangle(width / 2, height + 50, width, 100, wallOpts),
      Bodies.rectangle(-50, height / 2, 100, height, wallOpts),
      Bodies.rectangle(width + 50, height / 2, 100, height, wallOpts),
    ]);

    // Mouse drag
    const mouse = Mouse.create(canvas);
    const mouseConstraint = MouseConstraint.create(this.engine, {
      mouse,
      constraint: { stiffness: 0.2, render: { visible: false } },
    });
    World.add(this.world, mouseConstraint);
    this.render.mouse = mouse;

    // bookkeeping
    this.nodes = [];
    this.nodeBodies = [];
    this.center = { x: width * 0.5, y: height * 0.5 };

    // per-tick forces
    Events.on(this.engine, 'beforeUpdate', () => this.applyForces());
    window.addEventListener('resize', () => {
      this.center.x = this.render.canvas.width * 0.5;
      this.center.y = this.render.canvas.height * 0.45;
    });
  }

  /** Build a tree from adjacency (parent->children) and rootId, with layered initial positions */
  buildTree({ adjacency, rootId }) {
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
      const x =
        this.center.x * 0.2 +
        this.render.canvas.width * 0.6 * ((k + 1) / (slots + 1));
      const y = 80 + d * 90;
      const b = Bodies.circle(x, y, CFG.nodeRadius, {
        frictionAir: CFG.airFriction,
        render: {
          fillStyle: '#75d7ff',
          strokeStyle: '#dff6ff',
          lineWidth: 1.5,
        },
        collisionFilter: { group },
      });
      b.label = id;
      return b;
    };

    const bodyCache = new Map();
    const getBody = (id) =>
      bodyCache.get(id) || (bodyCache.set(id, makeBody(id)), bodyCache.get(id));

    const buildRec = (id) => {
      const node = new TreeNode(id, getBody(id));
      for (const cid of adjacency.get(id) || []) {
        const child = buildRec(cid);
        const cons = node.addChild(child, CFG.spring);
        World.add(this.world, cons);
      }
      return node;
    };

    const root = buildRec(rootId);
    const bodies = [...bodyCache.values()];
    World.add(this.world, bodies);

    // optional: pin root near top so the whole tree hangs upward
    const pin = Constraint.create({
      pointA: { x: this.center.x, y: this.center.y * 1.25 },
      bodyB: root.body,
      length: 0,
      stiffness: 0.9,
      damping: 0.4,
      render: { visible: false },
    });
    World.add(this.world, pin);

    // store refs
    this.root = root;
    this.nodes = [];
    root.traverse((n) => this.nodes.push(n));
    this.nodeBodies = this.nodes.map((n) => n.body);

    return root;
  }

  applyForces() {
    const list = this.nodeBodies;

    // 1) inverse gravity (constant upward force)
    for (const b of list) {
      Body.applyForce(b, b.position, { x: 0, y: -CFG.inverseGravity * b.mass });
    }

    // 2) repulsion (inverse-square, clamped)
    const { k, min, max } = CFG.repulsion;
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j];
        const dx = B.position.x - A.position.x;
        const dy = B.position.y - A.position.y;
        const r2 = dx * dx + dy * dy;
        if (r2 === 0) continue;
        const r = Math.sqrt(r2);
        if (r > max) continue;
        const clamped = Math.max(r, min);
        const mag = k / (clamped * clamped);
        const fx = (dx / r) * mag;
        const fy = (dy / r) * mag;
        Body.applyForce(A, A.position, { x: -fx, y: -fy });
        Body.applyForce(B, B.position, { x: fx, y: fy });
      }
    }

    // 3) gentle center pull to keep frame
    for (const b of list) {
      Body.applyForce(b, b.position, {
        x: (this.center.x - b.position.x) * CFG.centerPull,
        y: (this.center.y - b.position.y) * CFG.centerPull,
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
  const root = scene.buildTree({ adjacency, rootId: 'root' });

  // Example: traverse to style leaves differently
  root.traverse((n) => {
    if (n.children.length === 0) n.body.render.fillStyle = '#ffd27c';
  });
}
