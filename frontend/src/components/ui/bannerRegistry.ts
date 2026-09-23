let mountedCount = 0;

/** How many Banners are mounted right now. */
export function mountedBannerCount(): number {
  return mountedCount;
}

/**
 * Effect body for Banner: counts mounted instances and warns in development when more
 * than one coral strip is on screen (CLAUDE.md §6.2). Returns the cleanup.
 */
export function registerBanner(): () => void {
  mountedCount += 1;
  if (import.meta.env.DEV && mountedCount > 1) {
    console.warn(
      `[Banner] ${String(mountedCount)} Banners are mounted; DESIGN.md allows one coral strip per screen.`,
    );
  }
  return () => {
    mountedCount -= 1;
  };
}
