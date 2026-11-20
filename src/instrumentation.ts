/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { tuneNetwork } = await import("./lib/network");
    tuneNetwork();
    // Settings saved in Admin, Connections: loaded now, then kept fresh.
    const { loadRuntimeEnv } = await import("./lib/runtime-env");
    await loadRuntimeEnv(true).catch(() => {});
  }
}
