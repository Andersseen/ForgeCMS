import { defineEventHandler, getRequestURL, setHeader } from 'h3';

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    setHeader(event, 'X-Robots-Tag', 'noindex, nofollow');
  }
});
