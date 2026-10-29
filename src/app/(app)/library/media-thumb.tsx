"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";

/** Thumbnail for a library file served by /api/media/[id]. Videos show their first frame. */
export function MediaThumb({
  id,
  kind,
  alt,
  className,
}: {
  id: string;
  kind: "image" | "video";
  alt: string;
  className?: string;
}) {
  const src = `/api/media/${id}`;
  const base = cn("block bg-hover object-cover", className);
  if (kind === "video") return <VideoThumb src={src} alt={alt} className={base} />;
  // eslint-disable-next-line @next/next/no-img-element -- authenticated local media, not optimisable by next/image
  return <img src={src} alt={alt} loading="lazy" className={base} />;
}

/**
 * Videos have no lazy loading of their own, so a grid of them would fetch every file's metadata up front. Each tile
 * stays `preload="none"` (an empty tile) until it nears the viewport, then loads just enough for its first frame.
 */
function VideoThumb({ src, alt, className }: { src: string; alt: string; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <video ref={ref} src={near ? `${src}#t=0.1` : undefined} preload={near ? "metadata" : "none"} muted playsInline aria-label={alt} className={className} />;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
