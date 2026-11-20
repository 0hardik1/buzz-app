import { prepareAppBuilds } from "./build.mjs";
import { prepareFixtureDependencies } from "./vite-server.mjs";

export default async function setup() {
  const releaseDependencies = await prepareFixtureDependencies();
  // Local UI/watch sessions can rerun after source edits without setup rerunning.
  if (!process.env.CI) return releaseDependencies;
  try {
    const releaseBuilds = await prepareAppBuilds();
    return async () => {
      try {
        await releaseBuilds();
      } finally {
        await releaseDependencies();
      }
    };
  } catch (error) {
    await releaseDependencies();
    throw error;
  }
}
