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
  if (kind === "video") {
    return <video src={`${src}#t=0.1`} preload="metadata" muted playsInline aria-label={alt} className={base} />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- authenticated local media, not optimisable by next/image
  return <img src={src} alt={alt} loading="lazy" className={base} />;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
