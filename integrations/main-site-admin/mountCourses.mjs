import { modelDirectory, prepareBindings } from './modelDirectory.mjs';

// Mount on the main site's authenticated administration router, with the main site's middleware.
export function mountKuaixueCourses(
  router,
  {
    platform,
    requirePermission,
    requireCsrf,
    actorId,
    listCanvasModels = () => [],
    defaultVibeModelIds = () => [],
    resolveVibeModelLabels = async () => ({}),
  },
) {
  const base = '/api/admin/kuaixue/courses';
  function action(work) {
    return async (req, res, next) => {
      try {
        const actor = actorId(req);
        if (!actor) return res.sendStatus(403);
        res.set('Cache-Control', 'no-store');
        return res.json({ data: await work(actor, req.body) });
      } catch (error) {
        if (error.status === 409 || error.status === 400)
          return res.status(error.status).json({ error: { message: error.message } });
        next(error);
      }
    };
  }
  router.get(
    base,
    requirePermission('kuaixue.read'),
    action(() => platform.catalog(true)),
  );
  router.get(
    base + '/categories',
    requirePermission('kuaixue.read'),
    action(() => platform.catalogCategories()),
  );
  router.post(
    base + '/categories',
    requirePermission('kuaixue.publish'),
    requireCsrf,
    action((actor, config) => platform.saveCatalogCategories(actor, config)),
  );
  router.get(
    base + '/models',
    requirePermission('kuaixue.read'),
    action(async (actor) => modelDirectory(await listCanvasModels(actor))),
  );
  router.post(
    base + '/publish',
    requirePermission('kuaixue.publish'),
    requireCsrf,
    action(async (actor, draft) => {
      const baseCourse = draft.id && (await platform.catalog(true)).find((course) => course.id === draft.id);
      if (draft.id && baseCourse?.versionId !== draft.baseVersion)
        throw Object.assign(Error('课程已更新，请刷新后再发布'), { status: 409 });
      await prepareBindings(draft, baseCourse, () => listCanvasModels(actor));
      if (draft.recipeEditor === true) {
        const priorModes = baseCourse?.permittedDeliveryModes ?? [baseCourse?.type];
        draft.vibeModelIds = priorModes.includes('VIBECODING')
          ? baseCourse.vibeModelIds
          : draft.permittedDeliveryModes?.includes('VIBECODING')
            ? await defaultVibeModelIds(actor)
            : [];
        if (draft.permittedDeliveryModes?.includes('VIBECODING')) {
          const labels = await resolveVibeModelLabels(actor, draft.vibeModelIds || []);
          draft.vibeModelLabels = labels && Object.keys(labels).length
            ? labels
            : baseCourse?.vibeModelLabels || {};
        } else draft.vibeModelLabels = {};
        draft.modelPolicy = baseCourse?.modelPolicy || [];
      }
      return platform.publish(actor, draft);
    }),
  );
  router.post(
    base + '/hide',
    requirePermission('kuaixue.hide'),
    requireCsrf,
    action(async (actor, version) => {
      await platform.hide(actor, version);
      return { hidden: true };
    }),
  );
}
