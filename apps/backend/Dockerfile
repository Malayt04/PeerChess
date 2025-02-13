FROM node:23.6.0

WORKDIR /app

COPY  package* .

RUN npm install

COPY . .

EXPOSE 8080

CMD ["npm", "run", "dev"]

