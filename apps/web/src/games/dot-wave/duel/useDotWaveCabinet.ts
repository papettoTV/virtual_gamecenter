import { useEffect, useReducer, useRef } from "react";
import { createDotWaveCabinetController, type DotWaveCabinetController } from "./cabinetController";

export function useDotWaveCabinet() {
  const controller = useRef<DotWaveCabinetController | null>(null);
  const [, render] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const session = createDotWaveCabinetController(render);
    controller.current = session;
    session.start();
    render();
    return () => {
      session.dispose();
      controller.current = null;
    };
  }, []);
  return controller.current;
}
