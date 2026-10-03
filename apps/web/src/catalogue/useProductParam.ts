import { useCallback } from "react";
import { useSearchParams } from "react-router";

const PARAM = "set";

/**
 * The open product lives in the URL (?set=rose-chrome) so it can be shared,
 * and the browser's Back button closes the drawer.
 */
export function useProductParam() {
  const [params, setParams] = useSearchParams();
  const slug = params.get(PARAM);

  const open = useCallback(
    (next: string) =>
      setParams((p) => {
        p.set(PARAM, next);
        return p;
      }),
    [setParams],
  );

  const close = useCallback(
    () =>
      setParams(
        (p) => {
          p.delete(PARAM);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { slug, open, close };
}
