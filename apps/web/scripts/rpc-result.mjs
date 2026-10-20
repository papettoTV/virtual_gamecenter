export async function rpcResult(promise) {
  const result = await promise;
  try { return JSON.parse(JSON.stringify(result)); }
  finally { if (typeof result?.[Symbol.dispose] === "function") result[Symbol.dispose](); }
}
