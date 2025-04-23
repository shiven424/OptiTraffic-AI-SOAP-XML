FROM node:14
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV REACT_APP_API_URL=http://traffic_signal:5000
EXPOSE 3000
CMD ["npm", "start"]
