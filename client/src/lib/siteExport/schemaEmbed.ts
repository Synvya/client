export function jsonLdScriptTag(jsonLd: unknown): string {
  const jsonString = JSON.stringify(jsonLd, null, 2);
  const escapedJson = jsonString.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<script type="application/ld+json">\n${escapedJson}\n</script>`;
}


