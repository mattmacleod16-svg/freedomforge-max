import { GET as rootGET } from '../route';

export const runtime = 'nodejs';

export async function GET(req: Request) {
	return rootGET(req);
}
