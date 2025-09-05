import { useEffect, useRef, useState } from 'react'

import style from './App.module.css'
import { makeTree } from './tree';

function App() {
   const canvasRef = useRef(null);

   useEffect(() => {
    if (canvasRef.current && !canvasRef.current?.dataset.started) {
      canvasRef.current.dataset.started = 1;
      makeTree(canvasRef.current);
    }


   }, [])

  return (
    <div className={style.App}>
      <h1>matter tree</h1>
      <canvas id="scene" ref={canvasRef}></canvas>
    </div>
  )
}

export default App
