import type { PublicProduct } from "@happynails/shared";
import { NailArt } from "@happynails/ui";

/** Uploaded photo when there is one, otherwise the drawn set. */
export function ProductVisual({
  product,
  decorative = false,
}: {
  product: PublicProduct;
  decorative?: boolean;
}) {
  const photo = product.images[0];
  if (photo) {
    return <img src={photo.url} alt={decorative ? "" : photo.alt || product.name} loading="lazy" />;
  }
  return (
    <NailArt
      shape={product.shape}
      finish={product.finish}
      color={product.color}
      {...(product.color2 ? { color2: product.color2 } : {})}
      {...(decorative ? {} : { label: product.name })}
    />
  );
}
