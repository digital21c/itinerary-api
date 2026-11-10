/**
 * D1 bills rows read and written, not rows returned, so every query logs what it cost. A
 * query that reads far more rows than it returns is missing an index.
 */
export function logQueryCost(query: string, results: readonly D1Result[]): void {
  let rowsRead = 0;
  let rowsWritten = 0;
  for (const result of results) {
    rowsRead += result.meta.rows_read;
    rowsWritten += result.meta.rows_written;
  }
  console.log(JSON.stringify({ event: "d1-query", query, rowsRead, rowsWritten }));
}
