/* eslint-env node */

require('dotenv').config();
var path = require('path');
var webpack = require('webpack');
var HtmlWebpackPlugin = require('html-webpack-plugin');
var ExtractTextPlugin = require("extract-text-webpack-plugin");
var autoprefixer = require('autoprefixer');

var plugins = [
    new webpack.NoErrorsPlugin(),
    new webpack.EnvironmentPlugin([
        'NODE_ENV',
        'UOS_GOOGLE_API_KEY',
        'UOS_UBER_SERVER_TOKEN'
    ]),
    new HtmlWebpackPlugin({
        vars: {googleApiKey: process.env.UOS_GOOGLE_API_KEY},
        template: path.resolve(__dirname, 'src/index.ejs'),
        inject: false
    })
];
var cssLoader;

if (process.env.NODE_ENV == 'development') {
    cssLoader = 'style-loader!css?sourceMap&camelCase&importLoaders=2&localIdentName=[name]__[local]___[hash:base64:5]!postcss-loader!sass?sourceMap';
} else {
    plugins.push(
        new webpack.optimize.OccurrenceOrderPlugin(),
        new webpack.optimize.DedupePlugin(),
        new webpack.optimize.UglifyJsPlugin({
            compress: {drop_console: true, drop_debugger: true, warnings: false}
        }),
        new ExtractTextPlugin("bundle-[contenthash].css", {allChunks: true})
    );
    cssLoader = ExtractTextPlugin.extract('style-loader', 'css?camelCase&importLoaders=2&localIdentName=[name]__[local]___[hash:base64:5]!postcss-loader!sass');
}

module.exports = {
    resolve: {root: path.resolve(__dirname, 'src')},
    entry: [path.resolve(__dirname, 'src/index.js')],
    output: {
        path: path.resolve(__dirname, 'build'),
        filename: 'bundle-[hash].js'
    },
    module: {
        loaders: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                loader: 'babel-loader?cacheDirectory'
            },
            {
                test: /(\.scss$|\.css$)/,
                loader: cssLoader
            },
            {
                test: /(\.jpeg$|\.jpg$|\.gif$|\.png$|\.woff$|\.woff2$|\.ttf$|\.eot$)/,
                loader: 'url-loader',
                query: {limit: 8192}
            }
        ]
    },
    plugins: plugins,
    postcss: function() {return [autoprefixer];},
    devServer: {
        port: process.env.UOS_PORT,
        host: '0.0.0.0',
        contentBase: 'build',
        inline: true,
        colors: true
    }
};
