import { createApp } from "./app";
import { d1Repositories } from "./repositories/d1";

export default createApp((env) => d1Repositories(env.DB));
