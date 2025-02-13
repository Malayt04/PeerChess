FROM node:23.6.0

WORKDIR /app

COPY  package* .

RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]

