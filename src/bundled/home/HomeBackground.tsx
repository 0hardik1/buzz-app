import { useEffect, useState } from "react";
import { canvasFile } from "../../features/home/canvas-files";
import styles from "./HomeCanvas.module.css";

export function HomeBackground({
  scope,
  id,
  failed,
}: {
  scope: string;
  id: string | undefined;
  failed(message: string): void;
}) {
  const [source, setSource] = useState<{ id: string; url: string }>();
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let url: string | undefined;
    void canvasFile(scope, id).then(
      (file) => {
        if (!alive) return;
        if (!file) {
          failed("Your saved background is unavailable. Choose another image.");
          return;
        }
        url = URL.createObjectURL(file);
        setSource({ id, url });
      },
      () => {
        if (alive)
          failed(
            "Your saved background could not be opened. Choose another image.",
          );
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [scope, id, failed]);
  return id && source?.id === id ? (
    <img
      className={styles.background}
      src={source.url}
      alt=""
      draggable={false}
    />
  ) : null;
}
