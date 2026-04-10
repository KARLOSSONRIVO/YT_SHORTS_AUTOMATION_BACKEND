import axios from "axios";

export const createHttpClient = (baseURL?: string, timeout = 30_000) => {
  return axios.create({
    baseURL,
    timeout
  });
};
