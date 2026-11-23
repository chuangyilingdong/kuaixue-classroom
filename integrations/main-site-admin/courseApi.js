// Pass the main site's authenticated JSON request helper (including its CSRF policy).
// It resolves the JSON envelope or rejects for HTTP errors. Create once, outside React render.
export function createKuaixueAdminApi(request) {
  const prefix = '/api/admin/kuaixue/courses';
  async function send(action, body) {
    const result = await request(prefix + action, body === undefined ? {method:'GET'} : {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    });
    return result.data;
  }
  return {
    catalog: () => send(''),
    publish: draft => send('/publish', draft),
    hide: (id, baseVersion) => send('/hide', {id, baseVersion}),
  };
}
