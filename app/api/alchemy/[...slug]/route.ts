import { GET as rootGET, POST as rootPOST } from '../route';

export const runtime = 'nodejs';

export async function GET(req: Request) {
	return rootGET(req);
}

export async function POST(req: Request) {
	return rootPOST(req);
}
