import React from 'react';
import { createRoot } from 'react-dom/client';
import KuaixueCourses from './KuaixueCourses.jsx';
import { createKuaixueAdminApi } from './courseApi.js';

/** Mount inside the main site's authenticated admin shell. The caller owns session and CSRF. */
export function mountCourseEditor(element, request) {
  const root = createRoot(element);
  root.render(<KuaixueCourses api={createKuaixueAdminApi(request)} />);
  return () => root.unmount();
}
