import { useEffect, useRef, useState } from 'react'

import style from './App.module.css'
import { makeTree } from './tree';

function App() {
   const canvasRef = useRef(null);

   useEffect(() => {
    if (canvasRef.current && !canvasRef.current?.dataset.started) {
      const canvas = canvasRef.current;
      const container = canvas.parentElement;

      // Set canvas dimensions to match container minus padding
      const updateCanvasSize = () => {
        const containerStyle = getComputedStyle(container);
        const paddingLeft = parseFloat(containerStyle.paddingLeft);
        const paddingRight = parseFloat(containerStyle.paddingRight);
        const paddingTop = parseFloat(containerStyle.paddingTop);
        const paddingBottom = parseFloat(containerStyle.paddingBottom);

        const width = container.clientWidth - paddingLeft - paddingRight;
        const height = container.clientHeight - paddingTop - paddingBottom;

        // Set both canvas attributes and CSS dimensions to prevent scaling
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
      };

      updateCanvasSize();

      // Handle window resize
      const handleResize = () => {
        updateCanvasSize();
      };

      window.addEventListener('resize', handleResize);

      canvas.dataset.started = 1;
      makeTree(canvas);

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
   }, [])

  return (
    <div className={style.App}>
      <h1>matter tree</h1>
        <div className={style['canvas-area']}>
            <canvas id="scene" ref={canvasRef}></canvas>
        </div>
    </div>
  )
}

export default App
