export type ActionResult<T> =
  | {
      success: true;
      message: string;
      data: T;
    }
  | {
      success: false;
      message: string;
      errors?: Record<string, string[]>;
    };

export type InitialActionState = {
  success?: undefined;
  message?: undefined;
};
