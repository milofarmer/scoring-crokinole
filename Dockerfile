# Crokinole tournament scoring app — PHP + Apache, SQLite by default.
FROM php:8.3-apache

# SQLite (pdo_sqlite) ships with the base image; add pdo_mysql for the optional
# MySQL backend. Enable mod_rewrite/headers for clean serving.
RUN docker-php-ext-install pdo_mysql \
    && a2enmod rewrite headers

# Serve the public/ folder; keep src/ and data/ outside the web root.
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' \
      /etc/apache2/sites-available/000-default.conf /etc/apache2/apache2.conf

WORKDIR /var/www/html
COPY public/ ./public/
COPY src/    ./src/

# SQLite database lives in a writable volume.
RUN mkdir -p /var/www/html/data && chown -R www-data:www-data /var/www/html/data
VOLUME ["/var/www/html/data"]

EXPOSE 80
