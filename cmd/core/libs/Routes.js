import { Router } from 'express';

export const loadRoutes = async (routes, router = Router()) => {
  for (const [path, moduleURL] of routes) {
    try {
      const mod = await import(moduleURL);
      router.use(path, mod.default);
      console.log(`✅ Mounted ${path} from ${moduleURL}`);
    } catch (err) {
      console.error(`❌ Failed to load ${moduleURL} for path ${path}`);
      console.error(err);
    }
  }
  return router;
};
