export type UserRole = "admin" | "ta";

export type AppEnv = {
  Variables: {
    userId: string;
    userRole: UserRole;
  };
};
