FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

ENV NODE_OPTIONS=--experimental-global-webcrypto

CMD ["npm", "run", "start:prod"] 