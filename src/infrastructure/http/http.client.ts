import axios from "axios";

export const createHttpClient = (baseURL?: string) => {
  return axios.create({
    baseURL,
    timeout: 30_000
  });
};
