import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    const message = errorDescription ? `${error}: ${errorDescription}` : error;
    return NextResponse.json(
      {
        ok: false,
        message: "X authorization failed",
        error: message,
      },
      { status: 400 },
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      {
        ok: false,
        message: "Missing OAuth query parameters",
      },
      { status: 400 },
    );
  }

  const safeUrl = url.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return new NextResponse(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>X authorization received</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 24px; max-width: 760px; margin: 0 auto; }
      .box { background: #f5f5f5; border-radius: 10px; padding: 16px; overflow-wrap: anywhere; }
      h1 { margin-top: 0; }
    </style>
  </head>
  <body>
    <h1>X authorization received</h1>
    <p>Copy the full URL from your browser and send it back here to complete token exchange.</p>
    <div class="box">${safeUrl}</div>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}