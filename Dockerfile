FROM node:10
WORKDIR /app
COPY package.json package-lock.json /app/
RUN npm install
ADD . /app
ENV NODE_ENV production
RUN npm run build
ENV HOST 0.0.0.0
EXPOSE 3000
CMD npm start
