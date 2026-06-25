export const handler = async (event) => {
  console.log('received event', JSON.stringify(event));
  return { ok: true };
};
