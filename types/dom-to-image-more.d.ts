declare module "dom-to-image-more" {
  interface Options {
    filter?: (node: Node) => boolean;
    bgcolor?: string;
    width?: number;
    height?: number;
    style?: Record<string, string>;
    quality?: number;
    imagePlaceholder?: string;
    cacheBust?: boolean;
  }

  function toBlob(node: HTMLElement, options?: Options): Promise<Blob>;
  function toPng(node: HTMLElement, options?: Options): Promise<string>;
  function toJpeg(node: HTMLElement, options?: Options): Promise<string>;
  function toSvg(node: HTMLElement, options?: Options): Promise<string>;
  function toPixelData(node: HTMLElement, options?: Options): Promise<Uint8ClampedArray>;

  export default {
    toBlob,
    toPng,
    toJpeg,
    toSvg,
    toPixelData,
  };
}
