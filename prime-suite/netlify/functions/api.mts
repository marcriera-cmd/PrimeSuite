import type { Config } from '@netlify/functions';
import { handle } from '../../server/app.ts';

export default (req: Request) => handle(req);

export const config: Config = {
  path: ['/api/*', '/oidc/*', '/.well-known/openid-configuration', '/.well-known/jwks.json']
};
