// Mount on the main site's authenticated administration router, with the main site's middleware.
export function mountKuaixueCourses(router,{platform,requirePermission,requireCsrf,actorId}) {
  const base = '/api/admin/kuaixue/courses';
  function action(work) {
    return async (req,res,next) => {
      try {
        const actor = actorId(req);
        if (!actor) return res.sendStatus(403);
        res.set('Cache-Control','no-store');
        return res.json({data:await work(actor,req.body)});
      } catch (error) {
        if (error.status === 409 || error.status === 400) return res.status(error.status).json({error:{message:error.message}});
        next(error);
      }
    };
  }
  router.get(base,requirePermission('kuaixue.read'),action(() => platform.catalog(true)));
  router.post(base+'/publish',requirePermission('kuaixue.publish'),requireCsrf,action((actor,draft) => platform.publish(actor,draft)));
  router.post(base+'/hide',requirePermission('kuaixue.hide'),requireCsrf,action(async (actor,version) => {await platform.hide(actor,version);return {hidden:true};}));
}
