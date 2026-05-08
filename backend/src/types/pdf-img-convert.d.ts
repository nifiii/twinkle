declare module 'pdf-img-convert' {
  export interface ConvertOptions {
    width?: number;
    height?: number;
    page_numbers?: number[];
    base64?: boolean;
    format?: 'png' | 'jpeg' | string;
    scale?: number;
  }

  const pdf2img: {
    convert: (
      pdf: string | Uint8Array | Buffer,
      options?: ConvertOptions
    ) => Promise<Uint8Array[] | string[]>;
  };

  export default pdf2img;
}
