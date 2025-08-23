export class Deferred<T> {
  private _resolve!: (value: T) => void;
  private _reject!: (reason?: any) => void;

  private readonly _promise: Promise<T>;

  constructor() {
    this._promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  public resolve(value: T): void { 
    this._resolve(value);
  }

  public reject(reason?: any): void {
    this._reject(reason);
  }

  public promise(): Promise<T> {
    return this._promise;
  }
}