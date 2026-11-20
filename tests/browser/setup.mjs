import { prepareAppBuilds } from "./build.mjs";
import { prepareFixtureDependencies } from "./vite-server.mjs";

export default async function setup() {
  const releaseDependencies = await prepareFixtureDependencies();
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
