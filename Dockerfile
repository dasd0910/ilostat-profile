# Use a lightweight Python base image
FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Copy application files
COPY . ./

# Expose the port defined in server.py (8080)
EXPOSE 8080

# Run the custom proxy server
CMD ["python", "server.py"]
