import type { Config } from '@netlify/functions';
import { handleDemo } from '../../server/demo.ts';

export default (req: Request) => handleDemo(req);

export const config: Config = { path: '/demo-api/*' };
