export const ok = (res, data, { status = 200, meta = {} } = {}) =>
  res.status(status).json({ success: true, data, meta: { requestId: res.req.id, ...meta } });

export const paginated = (res, items, { page, limit, total }) => {
  const pages = Math.max(1, Math.ceil(total / limit));
  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      requestId: res.req.id,
      pagination: { page, limit, total, pages, hasNextPage: page < pages, hasPreviousPage: page > 1 },
    },
  });
};
