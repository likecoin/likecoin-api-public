FROM node:24.10

RUN apt update && apt install -y fonts-roboto && rm -rf /var/lib/apt/lists/*
RUN cd /usr/local/share/fonts/ \
  && wget -O NotoSansCJKtc-Regular.otf "https://raw.githubusercontent.com/googlefonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf" \
  && wget -O NotoSansCJKjp-Regular.otf "https://raw.githubusercontent.com/googlefonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf" \
  && wget -O NotoSansCJKsc-Regular.otf "https://raw.githubusercontent.com/googlefonts/noto-cjk/165c01b46ea533872e002e0785ff17e44f6d97d8/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf" \
  && fc-cache -f -v

WORKDIR /app
COPY package.json package-lock.json /app/
RUN npm install
ADD . /app
ENV NODE_ENV production
RUN npm run build
RUN mkdir "/.npm" && chown -R 1337:0 "/.npm"
ENV HOST 0.0.0.0
EXPOSE 3000
USER 1337
CMD npm start
