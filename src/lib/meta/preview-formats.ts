/** Placements we render previews for (client + server safe). */
export const PREVIEW_FORMATS = [
  { id: "MOBILE_FEED_STANDARD", label: "Facebook Feed", vertical: false },
  { id: "INSTAGRAM_STANDARD", label: "Instagram Feed", vertical: false },
  { id: "FACEBOOK_STORY_MOBILE", label: "Facebook Stories", vertical: true },
  { id: "INSTAGRAM_STORY", label: "Instagram Stories", vertical: true },
  { id: "FACEBOOK_REELS_MOBILE", label: "Facebook Reels", vertical: true },
  { id: "INSTAGRAM_REELS", label: "Instagram Reels", vertical: true },
] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number]["id"];
