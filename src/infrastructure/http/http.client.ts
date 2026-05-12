import axios from "axios";

export const createHttpClient = (baseURL?: string, timeout = 0) => {
  return axios.create({
    baseURL,
    timeout
  });
};
