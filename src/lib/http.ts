export function matchesRoute(
  request: Request,
  method: string,
  pathname: string,
): boolean {
  const url = new URL(request.url);

  return request.method === method && url.pathname === pathname;
}
