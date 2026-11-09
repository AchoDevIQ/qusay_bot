// الرابط القديم لمحطة الطباعة: يوديك للصفحة الجديدة
export const dynamic = "force-dynamic";

export const GET = (req: Request) => new Response(null, { status: 302, headers: { Location: `/store/station${new URL(req.url).search}` } });
