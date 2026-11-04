declare module "bcryptjs" {
  export function compare(
    data: string | Buffer,
    encrypted: string
  ): Promise<boolean>;

  export function hash(
    data: string | Buffer,
    salt: string | number
  ): Promise<string>;

  const bcrypt: {
    compare: typeof compare;
    hash: typeof hash;
  };

  export default bcrypt;
}