import type { QuoteLine } from "@happynails/shared";
import { NailArt } from "@happynails/ui";

export function LineThumb({ product }: { product: QuoteLine["product"] }) {
  if (!product) return <div className="th" aria-hidden="true" />;
  return (
    <div className="th" aria-hidden="true">
      {product.image ? (
        <img src={product.image.url} alt="" loading="lazy" decoding="async" width={144} height={144} />
      ) : (
        <NailArt
          shape={product.shape}
          finish={product.finish}
          color={product.color}
          {...(product.color2 ? { color2: product.color2 } : {})}
        />
      )}
    </div>
  );
}
