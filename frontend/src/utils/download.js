export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function filenameFrom(headers, fallback) {
  return headers?.["content-disposition"]?.match(/filename="?([^";]+)"?/)?.[1] || fallback;
}

/** Download a file response from an axios blob request. */
export async function saveResponse(promise, fallback) {
  const { data, headers } = await promise;
  downloadBlob(data, filenameFrom(headers, fallback));
}
